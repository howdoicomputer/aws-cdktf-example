{ pkgs, ... }:

{
  packages = [
    pkgs.git
    pkgs.terraform
    pkgs.awscli2
    pkgs.kubernetes-helm
    pkgs.argocd
    pkgs.kubectl
    pkgs.kustomize
    pkgs.k9s
  ];
  languages.typescript.enable = true;
}
