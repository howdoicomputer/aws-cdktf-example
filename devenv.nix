{ pkgs, ... }:

{
  packages = [ pkgs.git pkgs.terraform pkgs.awscli2 pkgs.eksctl pkgs.kubernetes-helm ];
  languages.typescript.enable = true;
}
