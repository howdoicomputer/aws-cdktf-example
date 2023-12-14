# polarstomps-infra

This project is intended to be a simple, toy reference architecture in AWS using the TypeScript version of [cdktf](https://github.com/hashicorp/terraform-cdk).

It deploys:

* An EKS/Kubernetes cluster on AWS that has a managed node pool.
* ArgoCD and Argo Rollouts as a deployment layer.
* Karpenter as the autoscaling mechanism.
* AWS LB Controller in order to use ALBs as ingresses for workloads.
* The VPC CNI add-on for EKS for VPC connectivity.
* The container observability add-on for EKS for sending logs to CloudWatch.

# polarstomps App

There is a Polarstomps application that is meant to be deployed to the infrastructure this repo sets up.

It lives here: https://github.com/howdoicomputer/polarstomps
The k8s manifests for it live here: https://github.com/howdoicomputer/polarstomps-argo

## Setting Up

The repository uses [devenv](https://devenv.sh/) as a way of setting up developer workspace dependencies. If you have devenv installed then CDing into the directory will take care of most CLI tools.

Otherwise you'll need to install:

* cdktf CLI and general Nodejs stuff
* helm
* argocd
* kubectl
* awscli
* terraform

## Deploying

``` sh
cdktf get
cdktf deploy
```

## Administration

In order to generate a password for the ArgoCD UI:

``` sh
argocd admin initial-password -n argocd
```

In order to setup your local kubeconfig:

``` sh
aws eks update-kubeconfig --name development|staging|production
```

In order to look at your ArgoCD deployments:

``` sh
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

In order to deploy the Guestbook example ArgoCD app:

``` sh
argocd app create guestbook --repo https://github.com/argoproj/argocd-example-apps.git --path guestbook --dest-server https://kubernetes.default.svc --dest-namespace default
```

In order to watch and/or debug autoscaling events:

``` sh
kubectl logs -f -n karpenter -l app.kubernetes.io/name=karpenter -c controller
```

If autoscaling is working, you'll see events like this:

``` sh
{"level":"INFO","time":"2023-12-14T08:24:51.212Z","logger":"controller.nodeclaim.lifecycle","message":"launched nodeclaim","commit":"5eda5c1","nodeclaim":"default-xbbj9","nodepool":"default","provider-id":"aws:///us-west-2b/i-001dcff2ad199d02d","instance-type":"t3.medium","zone":"us-west-2b","capacity-type":"spot","allocatable":{"cpu":"1930m","ephemeral-storage":"17Gi","memory":"3246Mi","pods":"17"}}
```

## Secrets

I was too lazy to codify the Helm chart installs for AWS Secrets Manager integration so the bootstrapping is here:

``` sh
helm repo add secrets-store-csi-driver https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts
helm repo add aws-secrets-manager https://aws.github.io/secrets-store-csi-driver-provider-aws
helm install -n kube-system csi-secrets-store secrets-store-csi-driver/secrets-store-csi-driver --set syncSecret.enabled=true
helm install -n kube-system secrets-provider-aws aws-secrets-manager/secrets-store-csi-driver-provider-aws
```

Any namespace that needs access to secrets needs a SecretProviderClass:

``` sh
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: eks-aws-secrets
  namespace: mynamespace
spec:
  provider: aws
  parameters:
    objects: |
        - objectName: "eksSecret"
          objectType: "secretsmanager"
```

## Environment

For this implementation, an environment is a logical construct that exists as a VPC with an EKS cluster within it. The cidrs are for the VPCs are `/16`s and each subnet is a `/24` with three private subnets and three public subnets. Each subnet public/private pair corresponds to an availability zone. The private subnets are where k8s worker nodes are deployed to and the public subnets are where load balancers live.

The difference between a private and public subnet is whether or not there is a route to an internet gateway defined. Most of the setup around subnets are handled by the [VPC](https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/latest) terraform module.

Code wise, an environment is handled by the `Environment` class and configured by the `EnvironmentOptions` interface.

Example:

``` typescript
    const dev = new Environment(this, "development", {
      env: "development",
      cidr: "10.1.0.0/16",
      privateSubnets: ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"],
      publicSubnets: ["10.1.4.0/24", "10.1.5.0/24", "10.1.6.0/24"],
      enableNatGateway: true,
      singleNatGateway: true,
      enableDnsHostnames: true,
    });
```

## Terraform State Backend

In `main.ts` I have Terraform Cloud configured as a remote backend and it's pointing to my personal organization. If you want to use this repo for anything then you'll need to configure that block.

## Cost Profile

This codebase tries not to incur unnecessary costs but they are inevitable.

For example,

* AWS NAT Gateway - charged per-hour it exists and the data coming through it
* The Karpenter nodes are spot-bid and can increase cost if you give a reason to scale

# Terraform Modules Used

Most of the heavy lifting is done by these modules:

* terraform-aws-modules/{vpc,eks,karpenter,irsa}
* DNXLabs/eks-lb-controller

Without them the amount of code needed to create all of these resources with the associated IAM primitives would be immense.

# Terraform Destroy

Since the AWS LB Controller creates load balancers on its own per an applications ingress specification Terraform has no idea about them. Therefore, if you are going to do a `cdktf destroy` to clean up your resources then make sure to undeploy any workloads using ALBs for ingress otherwise the destroy action will never be able to complete.

## Production

Please don't use this for production. If you want a reference for setting up EKS on AWS with all the bells and whistles then this might be able to help you out.

---
