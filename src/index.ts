import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import path from "path";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as exec from "@actions/exec";

const getWeekNumber = (date: Date): number => {
  date.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year.
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  // January 4 is always in week 1.
  var week1 = new Date(date.getFullYear(), 0, 4);
  // Adjust to Thursday in week 1 and count number of weeks from date to week1.
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

const generateHeadVer = (head: number, previous: string = '0.0.0'): string => {
  const previousHeadVer = previous.split('.').map((it) => parseInt(it));
  const previousHead = previousHeadVer[0];

  let newBuildVer: number;
  if (previousHead == head) {
    newBuildVer = previousHeadVer[2] + 1;
  } else {
    newBuildVer = 0;
  }

  const date = new Date();
  return `${head}.${(date.getFullYear() % 100).toString().padStart(2, '0')}${getWeekNumber(date).toString().padStart(2, '0')}.${newBuildVer}`;
}

async function main() {
  const githubToken = core.getInput('github-token', { required: false });
  const configFileName = core.getInput('config-file-name', { required: false });

  if (context.eventName !== "push") {
    throw new Error(`${context.eventName} not supported`);
  }

  const octokit = getOctokit(githubToken);
  const { data } = await octokit.rest.repos.compareCommits({
    ...context.repo,
    base: context.payload["before"],
    head: context.payload["after"],
  });

  const diffingFiles = data.files ?? [];
  const diffingDirs = Array.from(new Set(diffingFiles.filter(it => it.filename.includes(configFileName) || it.filename.includes("Dockerfile")).map(it => path.dirname(it.filename))));

  core.debug(`diffingDirs: ${JSON.stringify(diffingDirs)}`);

  const promises = diffingDirs.map(async (dir) => {
    const configFilePath = `${dir}/${configFileName}`;
    core.debug(`configFilePath: ${configFilePath}`);

    if (fs.existsSync(configFilePath)) {
      const { registries = [], repository, head, targetDockerfile = "Dockerfile" }: { registries: string[] | undefined, repository: string, head: number, targetDockerfile: string | undefined } = yaml.load(fs.readFileSync(configFilePath, 'utf-8')) as any;
      const tagPrefix = `${repository}-`;
      const { data } = await octokit.rest.git.listMatchingRefs({
        ...context.repo,
        ref: `tags/${tagPrefix}`,
      });
      core.debug(`data: ${JSON.stringify(data)}`);

      let collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})
      const latestVersion = data.map((it) => it.ref).map((it) => it.replace(`refs/tags/${tagPrefix}`, '')).sort(collator.compare).reverse()[0];
      core.debug(`latestVersion: ${latestVersion}`);

      const newHeadVer = generateHeadVer(head, latestVersion);
      core.debug(`newHeadVer: ${newHeadVer}`);

      const newImageTag = `${repository}:${newHeadVer}`

      await exec.exec("docker", ["build", "-f", `${dir}/${targetDockerfile}`, "--tag", newImageTag, dir]);

      for (const registry of registries) {
        const newImageTagWithRegistry = `${registry}/${newImageTag}`;
        await exec.exec("docker", ["image", "tag", newImageTag, newImageTagWithRegistry]);
        await exec.exec("docker", ["push", newImageTagWithRegistry]);
        await exec.exec("docker", ["image", "tag", newImageTagWithRegistry, newImageTag]);
      }

      return octokit.rest.git.createRef({
        ...context.repo,
        ref: `refs/tags/${tagPrefix}${newHeadVer}`,
        sha: context.payload["after"],
      });
    }
  });
  await Promise.all(promises);
}

main();
