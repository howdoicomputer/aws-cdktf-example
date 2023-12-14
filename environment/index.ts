import { Fn } from "cdktf";
import { Construct } from "constructs";
import { EksLbController } from "../.gen/modules/DNXLabs/aws/eks-lb-controller";
import { Eks } from "../.gen/modules/terraform-aws-modules/aws/eks";
import { Karpenter } from "../.gen/modules/terraform-aws-modules/aws/eks/modules/karpenter";
import { IamRoleForServiceAccountsEks } from "../.gen/modules/terraform-aws-modules/aws/iam/modules/iam-role-for-service-accounts-eks";
import { Vpc } from "../.gen/modules/terraform-aws-modules/aws/vpc";
import { DataAwsAvailabilityZones } from "../.gen/providers/aws/data-aws-availability-zones";
import { DataAwsEksClusterAuth } from "../.gen/providers/aws/data-aws-eks-cluster-auth";
import { Release } from "../.gen/providers/helm/release";
import { Manifest } from "../.gen/providers/kubectl/manifest";

interface EnvironmentOptions {
  env: "development" | "staging" | "production";
  cidr: string;
  privateSubnets: string[];
  publicSubnets: string[];
  enableNatGateway: boolean;
  singleNatGateway: boolean;
  enableDnsHostnames: boolean;
}

export class Environment extends Construct {
  public vpc: Vpc;
  public eks: Eks;
  public eksAuth: DataAwsEksClusterAuth;

  constructor(scope: Construct, name: string, options: EnvironmentOptions) {
    super(scope, name);

    const allAwsAvailabilityZones = new DataAwsAvailabilityZones(
      this,
      "all-availability-zones",
      {}
    ).names;

    this.vpc = new Vpc(this, options.env, {
      name: options.env,
      cidr: options.cidr,
      azs: allAwsAvailabilityZones,
      privateSubnets: options.privateSubnets,
      publicSubnets: options.publicSubnets,
      enableNatGateway: options.enableNatGateway,
      singleNatGateway: options.singleNatGateway,
      enableDnsHostnames: options.enableDnsHostnames,

      tags: {
        ["env"]: options.env,
      },
      publicSubnetTags: {
        "kubernetes.io/role/elb": "1",
      },
      privateSubnetTags: {
        "kubernetes.io/role/internal-elb": "1",
        "karpenter.sh/discovery": options.env,
      },
    });

    this.eks = new Eks(this, "eks", {
      clusterName: options.env,
      clusterVersion: "1.28",
      clusterEndpointPublicAccess: true,
      clusterEndpointPublicAccessCidrs: ["76.132.5.161/32"],
      createCniIpv6IamPolicy: true,
      subnetIds: Fn.tolist(this.vpc.privateSubnetsOutput),
      vpcId: this.vpc.vpcIdOutput,
      manageAwsAuthConfigmap: true,
      eksManagedNodeGroupDefaults: {
        iam_role_attach_cni_policy: true,
      },
      awsAuthRoles: [
        {
          rolearn: karpenter.roleArnOutput
        }
      ]
      nodeSecurityGroupTags: {
        "karpenter.sh/discovery": options.env,
      },
      eksManagedNodeGroups: {
        green: {
          min_size: 1,
          max_size: 10,
          desired_size: 3,
          instance_types: ["t3.medium"],
          capacity_type: "SPOT",
          create_iam_role: true,
          iam_role_additional_policies: {
            CloudWatchAgentServerPolicy:
              "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
            AWSXRayWriteOnlyAccess:
              "arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess",
          },
          iam_role_attach_cni_policy: true,
        },
      },
      clusterAddons: {
        "vpc-cni": {
          most_recent: true,
          resolve_conflict_on_create: "OVERWRITE",
          resolve_conflict_on_update: "OVERWRITE",
        },
        "amazon-cloudwatch-observability": {
          most_recent: true,
          resolve_conflict_on_create: "OVERWRITE",
          resolve_conflict_on_update: "OVERWRITE",
        },
      },
      tags: {
        environment: options.env,
      },
    });

    const helmKarpenter = new Release(this, "karpenter_helm", {
      namespace: "karpenter",
      createNamespace: true,
      name: "karpenter",
      repository: "oci://public.ecr.aws/karpenter",
      chart: "karpenter",
      version: "v0.32.2",
      values: [
        `
    settings:
      clusterName: ${this.eks.clusterName}
      clusterEndpoint: ${this.eks.clusterEndpointOutput}
      interruptionQueueName: ${karpenter.queueName}
    serviceAccount:
      annotations:
        eks.amazonaws.com/role-arn: ${karpenter.irsaArnOutput}
`,
      ],
    });

    const manifestKarpenterNodeClass = new Manifest(
      this,
      "karpenter_node_class",
      {
        yamlBody: `
    apiVersion: karpenter.k8s.aws/v1beta1
    kind: EC2NodeClass
    metadata:
      name: default
    spec:
      amiFamily: AL2
      role: ${karpenter.roleNameOutput}
      subnetSelectorTerms:
        - tags:
            karpenter.sh/discovery: ${this.eks.clusterName}
      securityGroupSelectorTerms:
        - tags:
            karpenter.sh/discovery: ${this.eks.clusterName}
      tags:
        karpenter.sh/discovery: ${this.eks.clusterName}
`,
        dependsOn: [helmKarpenter],
      }
    );

    new Manifest(this, "karpenter_node_pool", {
      yamlBody: `
    apiVersion: karpenter.sh/v1beta1
    kind: NodePool
    metadata:
      name: default
    spec:
      template:
        spec:
          nodeClassRef:
            name: default
          requirements:
            - key: "node.kubernetes.io/instance-type"
              operator: In
              values: ["t3.medium"]
      limits:
        cpu: 1000
      disruption:
        consolidationPolicy: WhenEmpty
        consolidateAfter: 30s
`,
      dependsOn: [manifestKarpenterNodeClass],
    });

    new Release(this, "argocd_cd", {
      namespace: "argocd",
      createNamespace: true,
      name: "argocd",
      repository: "https://argoproj.github.io/argo-helm",
      chart: "argo-cd",
      version: "5.51.6",
      lifecycle: {
        ignoreChanges: "all",
      },
    });

    new Release(this, "argocd_rollouts", {
      namespace: "argocd",
      createNamespace: true,
      name: "argo-rollouts",
      repository: "https://argoproj.github.io/argo-helm",
      chart: "argo-rollouts",
      version: "2.32.7",
      lifecycle: {
        ignoreChanges: "all",
      },
    });

    new EksLbController(this, "eks_lb_controller", {
      clusterIdentityOidcIssuer: this.eks.clusterOidcIssuerUrlOutput,
      clusterIdentityOidcIssuerArn: this.eks.oidcProviderArnOutput,
      clusterName: this.eks.clusterNameOutput,
      helmChartVersion: "1.4.4",
    });

    new IamRoleForServiceAccountsEks(this, "irsa_karpenter", {
      roleName: "karpenter_controller",
      createRole: true,
      attachKarpenterControllerPolicy: true,
      karpenterControllerClusterName: this.eks.clusterName,
      enableKarpenterInstanceProfileCreation: true,
      karpenterControllerNodeIamRoleArns: [
        Fn.lookupNested(this.eks.eksManagedNodeGroupsOutput, [
          "green",
          "iam_role_arn",
        ]),
      ],
      oidcProviders: {
        main: {
          provider_arn: this.eks.oidcProviderArnOutput,
          namespace_service_accounts: ["karpenter:karpenter"],
        },
      },
      tags: {
        Environment: options.env,
      },
    });

    new IamRoleForServiceAccountsEks(this, "irsa_vpc_cni", {
      roleName: "vpc_cni",
      attachVpcCniPolicy: true,
      vpcCniEnableIpv4: true,
      oidcProviders: {
        main: {
          provider_arn: this.eks.oidcProviderArnOutput,
          namespace_service_accounts: ["kube-system:aws-node"],
        },
      },
      tags: {
        Environment: options.env,
      },
    });

    this.eksAuth = new DataAwsEksClusterAuth(this, "eks-auth", {
      name: this.eks.clusterNameOutput,
    });
  }
}
