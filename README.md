# aws-cdktf-example

This project is a very simple reference architecture in AWS using the TypeScript version of [cdktf](https://github.com/hashicorp/terraform-cdk).

## In Progresss

This repository is in progress. It's meant to serve as a reference/playground.

Technologies:

* cdktf TypeScript
* EKS/Kubernetes
* ArgoCD
* Helm
* devenv
* Karpenter

## Environment

Within this reference, an environment is a logical construct that exists as a VPC with an EKS cluster within it. The cidrs are for the VPCs are `/16` and each subnet is a `/24` with three private subnets and three public subnets. Each subnet public/private pair corresponds to an availability zone. The private subnets are where k8s worker nodes are deployed to and the public subnets are where load balancers live.

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

## TODO

[x] - VPC/NAT Gateway/IG
[x] - EKS cluster
[] - Split components into cdktf stacks
[] - ArgoCD installation
[] - Karpenter installation
[] - Separate Helm/manifest repo for target app
[] - Use Terraform Cloud as state backend

## Getting Started

The dev environment uses [devenv](https://devenv.sh/getting-started/#installation) to manage dependencies. If you're using devenv you can `cd` into the this project and get a Nix powered development environment.

Otherwise, you will need:

* Node/JavaScript/TypeScript/yarn
* Terraform
* awscli that is setup to use an AWS account
* kubectl

The environment and other components are separate cdktf [stacks](https://developer.hashicorp.com/terraform/cdktf/concepts/stacks).

Due to the nature of the dependencies, you will need to bootstrap an environment with `cdktf deploy --`

## EKS Makeup

* Karpenter - the ability to autoscale the EKS cluster for unschedudulable resources
* ArgoCD - GitOps tool for syncing k8s state to each EKS cluster
* AWS Load Balancer Controller Add-on - adds the ability for k8s workloads to use an AWS load balancer type as an ingress

## Cost Profile

This codebase tries not to incur unnecessary costs but they are inevitable.

For example,

* AWS NAT Gateway - charged per-hour it exists and the data coming through it
* The Karpenter nodes are spot-bid and can increase cost if you give a reason to scale

## Potential Improvements

### Use AWS Accounts as Env

AWS managed resources are global to an account. This codebase uses VPCs and EKS to represent a logical environment. However, this boundary only recovers a slice of resources; security groups, buckets, etc would need additional controls to create an environmental boundaries.

Using AWS accounts as environment silos allows you to create silos for AWS global resources and is actually the recommended practice by AWS.

### Shell Access

Currently there is no bastion host or an administrator subnet for it to exist in. A good way of solving instance connectivity in AWS is to use [session manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html) to create shells for remote access. This is generally superior to SSH as it removes the need for opening up port 22, allows you to use IAM policies for authorization, and also allows auditing by shipping access trail logs to CloudTrail and session logs to CloudWatch.

### Access to AWS Hosted Services

This codebase does not set up any of the prerequisites for a VPN. One potential solution is to use a [Tailscale subnet router](https://tailscale.com/kb/1296/aws-reference-architecture/#ip-based-connectivity-with-subnet-router) to connect a Tailscale network to your AWS network. This would allow any Tailscale-enabled workstation to, say, query RDS directly.

### Inter-VPC Communication

This codebase assumes that environments are hermetic. There are multiple ways to get VPCs to talk to each other: VPC peering and Transit Gateway. There are pros and cons to both.
