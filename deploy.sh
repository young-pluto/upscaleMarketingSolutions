#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: ./deploy.sh -m \"commit message\""
  exit 1
}

commit_message=""

while getopts ":m:h" opt; do
  case "$opt" in
    m)
      commit_message="$OPTARG"
      ;;
    h)
      usage
      ;;
    :)
      echo "Error: option -$OPTARG requires an argument."
      usage
      ;;
    \?)
      echo "Error: invalid option -$OPTARG"
      usage
      ;;
  esac
done

if [[ -z "$commit_message" ]]; then
  echo "Error: commit message is required."
  usage
fi

git add -A
git commit -m "$commit_message"
git push origin main
