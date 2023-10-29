import { Fn } from "cdktf";
import { Construct } from "constructs";
import { Eks } from "../.gen/modules/terraform-aws-modules/aws/eks";
import { Vpc } from "../.gen/modules/terraform-aws-modules/aws/vpc";
import { DataAwsAvailabilityZones } from "../.gen/providers/aws/data-aws-availability-zones";
import { DataAwsEksClusterAuth } from "../.gen/providers/aws/data-aws-eks-cluster-auth";
import { HelmProvider } from "../.gen/providers/helm/provider";

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
            },
        });

        this.eks = new Eks(this, "eks", {
            clusterName: options.env,
            clusterVersion: "1.28",
            clusterEndpointPublicAccess: true,
            clusterEndpointPublicAccessCidrs: ["76.132.5.161/32"],
            subnetIds: Fn.tolist(this.vpc.privateSubnetsOutput),
            vpcId: this.vpc.vpcIdOutput,
            eksManagedNodeGroupDefaults: {
                intanceTypes: "t2.micro",
            },
            eksManagedNodeGroups: {
                green: {
                    minSize: 1,
                    maxSize: 2,
                    desiredSize: 1,
                    instanceTypes: ["t2.micro"],
                },
            },
            tags: {
                environment: options.env,
            },
        });

        this.eksAuth = new DataAwsEksClusterAuth(this, "eks-auth", {
            name: this.eks.clusterNameOutput,
        });
    }
}
