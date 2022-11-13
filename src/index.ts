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

const generateHeadVer = (head: number, previous: string): string => {
  const previousHeadVer = previous.split('.').map((it) => parseInt(it));
  const previousHead = previousHeadVer[0];

  let newBuildVer: number;
  if (previousHead == head) {
    newBuildVer = previousHeadVer[2] + 1;
  } else {
    newBuildVer = 0;
  }

  const date = new Date();
  return `${head}.${date.getFullYear() % 100}${getWeekNumber(date)}.${newBuildVer}`;
}

const main = async () => {
  const githubToken = core.getInput('github-token', { required: false });
  const registry = core.getInput('registry', { required: false });
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
  const diffingDirs = diffingFiles.filter(it => it.filename.includes(configFileName)).map(it => path.dirname(it.filename));

  const promises = diffingDirs.map(async (dir) => {
    const configFile: { repository: string, head: number } = yaml.load(fs.readFileSync(`${dir}/${configFileName}`, 'utf-8')) as any;
    const tagPrefix = `refs/tags/${configFile.repository}-`;
    const { data } = await octokit.rest.git.listMatchingRefs({
      ...context.repo,
      ref: tagPrefix,
    });
    const latestVersion = data.map((it) => it.ref).map((it) => it.replace(tagPrefix, '')).reverse()[0];

    const newHeadVer = generateHeadVer(configFile.head, latestVersion);

    const newImageTag = `${registry}/${configFile.repository}:${newHeadVer}`

    await exec.exec("docker", ["build", "--tag", newImageTag, "--context", dir, dir]);
    await exec.exec("docker", ["push", newImageTag]);
    return octokit.rest.git.createRef({
      ...context.repo,
      ref: `${tagPrefix}${newHeadVer}`,
      sha: context.payload["after"],
    });
  });
  await Promise.all(promises);
}

main();
