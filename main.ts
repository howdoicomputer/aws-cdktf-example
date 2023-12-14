import { App, Fn, RemoteBackend, TerraformStack } from "cdktf";
import { Construct } from "constructs";
import { AwsProvider } from "./.gen/providers/aws/provider";
import { HelmProvider } from "./.gen/providers/helm/provider";
import { KubectlProvider } from "./.gen/providers/kubectl/provider";
import { KubernetesProvider } from "./.gen/providers/kubernetes/provider";
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
