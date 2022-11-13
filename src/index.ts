import * as core from "@actions/core";

const main = () => {
  const githubToken = core.getInput('github-token', { required: false });
  const registry = core.getInput('registry', { required: false });
  const username = core.getInput('username', { required: false });
  const password = core.getInput('password', { required: false });
}

main();
