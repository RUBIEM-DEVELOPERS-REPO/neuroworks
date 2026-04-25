import { Octokit } from "@octokit/rest";
import { simpleGit } from "simple-git";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

// Local-only utility: takes a folder, ensures it's a git repo,
// creates a matching GitHub repo (private by default), pushes.
//
// Usage:
//   GITHUB_TOKEN=ghp_... GITHUB_OWNER=arthurmagaya \
//     npx tsx src/publish-folder.ts "C:\path\to\folder" [--public] [--name custom-name]

async function main() {
  const args = process.argv.slice(2);
  const folder = args.find(a => !a.startsWith("--"));
  if (!folder) {
    console.error("usage: publish-folder <path> [--public] [--name <repo-name>]");
    process.exit(1);
  }
  const isPublic = args.includes("--public");
  const nameIdx = args.indexOf("--name");
  const repoName = nameIdx >= 0 ? args[nameIdx + 1] : sanitizeName(basename(resolve(folder)));

  const token = mustEnv("GITHUB_TOKEN").trim();
  const owner = mustEnv("GITHUB_OWNER").trim();

  if (!existsSync(folder)) {
    console.error(`folder not found: ${folder}`);
    process.exit(1);
  }

  const git = simpleGit(folder);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    console.log(`init git repo in ${folder}`);
    await git.init();
    await git.add(".");
    await git.commit("initial import");
  } else {
    const status = await git.status();
    if (status.files.length > 0) {
      await git.add(".");
      await git.commit("clawbot: snapshot before publish");
    }
  }

  const octokit = new Octokit({ auth: token });
  let cloneUrl: string;
  try {
    const { data } = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      private: !isPublic,
      description: `Auto-published by clawbot from local folder: ${basename(folder)}`,
    });
    cloneUrl = data.clone_url;
    console.log(`created repo ${data.full_name}`);
  } catch (err: any) {
    if (err.status === 422) {
      console.log(`repo ${owner}/${repoName} already exists, will reuse`);
      cloneUrl = `https://github.com/${owner}/${repoName}.git`;
    } else {
      throw err;
    }
  }

  const remoteUrl = cloneUrl.replace("https://", `https://x-access-token:${token}@`);
  const remotes = await git.getRemotes();
  if (remotes.find(r => r.name === "origin")) {
    await git.removeRemote("origin");
  }
  await git.addRemote("origin", remoteUrl);
  const branch = (await git.branchLocal()).current || "main";
  await git.push(["-u", "origin", branch]);
  console.log(`pushed ${folder} -> ${owner}/${repoName} (${branch})`);
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing env: ${name}`); process.exit(1); }
  return v;
}

main().catch(err => { console.error(err); process.exit(1); });
