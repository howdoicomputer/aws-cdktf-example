import { App, Fn, RemoteBackend, TerraformStack, Token } from "cdktf";
import { Construct } from "constructs";
import { IamRoleForServiceAccountsEks } from "./.gen/modules/terraform-aws-modules/aws/iam/modules/iam-role-for-service-accounts-eks";
import { DataAwsSecretsmanagerSecret } from "./.gen/providers/aws/data-aws-secretsmanager-secret";
import { DataAwsSecretsmanagerSecretVersion } from "./.gen/providers/aws/data-aws-secretsmanager-secret-version";
import { DbInstance } from "./.gen/providers/aws/db-instance";
import { DbSubnetGroup } from "./.gen/providers/aws/db-subnet-group";
import { IamPolicy } from "./.gen/providers/aws/iam-policy";
import { AwsProvider } from "./.gen/providers/aws/provider";
import { HelmProvider } from "./.gen/providers/helm/provider";
import { KubectlProvider } from "./.gen/providers/kubectl/provider";
import { Namespace } from "./.gen/providers/kubernetes/namespace";
import { KubernetesProvider } from "./.gen/providers/kubernetes/provider";
import { ServiceAccount } from "./.gen/providers/kubernetes/service-account";
import { GrantRole } from "./.gen/providers/postgresql/grant-role";
import { PostgresqlProvider } from "./.gen/providers/postgresql/provider";
import { Role } from "./.gen/providers/postgresql/role";
import { Environment } from "./environment";

class DevEnvironmentStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    new AwsProvider(this, "aws", { region: "us-west-2" });

    const dev = new Environment(this, "development", {
      env: "development",
      cidr: "10.1.0.0/16",
      privateSubnets: ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"],
      publicSubnets: ["10.1.4.0/24", "10.1.5.0/24", "10.1.6.0/24"],
      enableNatGateway: true,
      singleNatGateway: true,
      enableDnsHostnames: true,
    });

    new KubernetesProvider(this, "cluster", {
      host: dev.eks.clusterEndpointOutput,
      clusterCaCertificate: Fn.base64decode(
        dev.eks.clusterCertificateAuthorityDataOutput
      ),
      token: dev.eksAuth.token,
    });

    new HelmProvider(this, "helm", {
      kubernetes: {
        host: dev.eks.clusterEndpointOutput,
        clusterCaCertificate: Fn.base64decode(
          dev.eks.clusterCertificateAuthorityDataOutput
        ),
        token: dev.eksAuth.token,
      },
    });

    new KubectlProvider(this, "kubectl", {
      host: dev.eks.clusterEndpointOutput,
      clusterCaCertificate: Fn.base64decode(
        dev.eks.clusterCertificateAuthorityDataOutput
      ),
      token: dev.eksAuth.token,
      loadConfigFile: true,
    });

    const dbSubnetGroup = new DbSubnetGroup(this, "db_subnet_group", {
      name: "main",
      subnetIds: ["subnet-083a988f3bb4425eb", "subnet-0909ac80992621433"],
      tags: {
        Name: "Main DB subnet group",
      },
    });

    const db = new DbInstance(this, "polarstomps_db", {
      dbSubnetGroupName: dbSubnetGroup.name,
      publiclyAccessible: true,
      allocatedStorage: 10,
      dbName: "polarstomps",
      engine: "postgres",
      instanceClass: "db.t3.micro",
      username: "polarstomps",
      manageMasterUserPassword: true,
    });

    const dbSecret = new DataAwsSecretsmanagerSecret(
      this,
      "polarstomps_db_secret",
      {
        arn: db.masterUserSecret.get(0).secretArn,
      }
    );

    const pw = new DataAwsSecretsmanagerSecretVersion(
      this,
      "polarstomps_db_secret_value",
      {
        secretId: dbSecret.id,
      }
    );

    new PostgresqlProvider(this, "postgresql", {
      host: db.address,
      port: db.port,
      username: "polarstomps",
      password: pw.secretString,
      connectTimeout: 10,
    });

    const dbRole = new GrantRole(this, "polarstomps_grant", {
      role: "polarstomps",
      grantRole: "rds_iam",
    });

    new Namespace(this, "polarstomps_ns", {
      metadata: {
        name: "polarstomps",
        labels: {
          "elbv2.k8s.aws/pod-readiness-gate-inject": "enabled",
        },
      },
    });

    const policy = new IamPolicy(this, "polarstomps_access", {
      description: "Policy for accessing secrets for polarstomps pod",
      name: "polarstomps",
      path: "/",
      policy: Token.asString(
        Fn.jsonencode({
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret",
              ],
              Resource: [
                "arn:aws:secretsmanager:us-west-2:661312080734:secret:eksSecret-GJ7R8I",
              ],
            },
            {
              Effect: "Allow",
              Action: ["rds-db:connect"],
              Resource: [
                `arn:aws:rds-db:*:*:dbuser${db.resourceId}/polarstomps`,
              ],
            },
          ],
          Version: "2012-10-17",
        })
      ),
    });

    const role = new IamRoleForServiceAccountsEks(
      this,
      "polarstomps_irsa_role",
      {
        roleName: "polarstomps",
        createRole: true,
        rolePolicyArns: {
          policy: policy.arn,
        },
        oidcProviders: {
          main: {
            provider_arn: dev.eks.oidcProviderArnOutput,
            namespace_service_accounts: ["polarstomps:polarstomps"],
          },
        },
      }
    );

    new ServiceAccount(this, "polarstomps_sa", {
      metadata: {
        name: "polarstomps",
        namespace: "polarstomps",
        annotations: {
          "eks.amazonaws.com/role-arn": role.iamRoleArnOutput,
        },
      },
    });
  }
}

class StageEnvironmentStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    new AwsProvider(this, "aws", { region: "us-west-2" });

    new Environment(this, "staging", {
      env: "staging",
      cidr: "10.2.0.0/16",
      privateSubnets: ["10.2.1.0/24", "10.2.2.0/24", "10.2.3.0/24"],
      publicSubnets: ["10.2.4.0/24", "10.2.5.0/24", "10.2.6.0/24"],
      enableNatGateway: true,
      singleNatGateway: true,
      enableDnsHostnames: true,
    });
  }
}

class ProdEnvironmentStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    new AwsProvider(this, "aws", { region: "us-west-2" });

    new Environment(this, "production", {
      env: "production",
      cidr: "10.3.0.0/16",
      privateSubnets: ["10.3.1.0/24", "10.3.2.0/24", "10.3.3.0/24"],
      publicSubnets: ["10.3.4.0/24", "10.3.5.0/24", "10.3.6.0/24"],
      enableNatGateway: true,
      singleNatGateway: true,
      enableDnsHostnames: true,
    });
  }
}

const app = new App();

// Only deploy the dev environment because expensive!
//
const stack = new DevEnvironmentStack(app, "polarstomps-dev");

new RemoteBackend(stack, {
  hostname: "app.terraform.io",
  organization: "howdoicomputer",
  workspaces: {
    name: "default",
  },
});

app.synth();
