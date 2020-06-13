const { Octokit } = require("@octokit/rest");
const { retry } = require("@octokit/plugin-retry");
const { throttling } = require("@octokit/plugin-throttling");

const MyOctokit = Octokit.plugin(retry, throttling);
const octokit = new MyOctokit({
  auth: require('./auth.json'),
  userAgent: "octohush",
  timeZone: "US/Pacific",
  baseUrl: 'https://api.github.com',
  throttle: {
    onRateLimit: (retryAfter, options) => {
      myOctokit.log.warn(
        `Request quota exhausted for request ${options.method} ${options.url}`
      );

      if (options.request.retryCount === 0) {
        // only retries once
        myOctokit.log.info(`Retrying after ${retryAfter} seconds!`);
        return true;
      }
    },
    onAbuseLimit: (retryAfter, options) => {
      // does not retry, only logs a warning
      myOctokit.log.warn(
        `Abuse detected for request ${options.method} ${options.url}`
      );
    },
  }
});

function sleep(s) {
  return new Promise(resolve => setTimeout(resolve, 1000 * s));
}

(async () => {
  console.log("Starting...");
  let last = 0;
  while (1) {
    let nextLast = new Date().toISOString();
    await doPoll(last);
    last = nextLast;
    await sleep(60);
  }
})();

function parseIssue(url) {
  const parts = url.split("/");
  const num = parts.pop();
  parts.pop(); // "/issues"
  const repo = parts.pop();
  const owner = parts.pop();
  return {owner: owner, repo: repo, issue_number: num};
}

function parsePR(url) {
  const parts = url.split("/");
  const num = parts.pop();
  parts.pop(); // "/issues"
  const repo = parts.pop();
  const owner = parts.pop();
  return {owner: owner, repo: repo, pull_number: num};
}

async function killnote(id) {
  try {
  await octokit.activity.markThreadAsRead({thread_id: id});
  await octokit.activity.deleteThreadSubscription({thread_id: id});
  } catch(e) {
    console.log('failed to ignore thread ', id);
  }
}

async function doPoll(from) {
  let op = {};
  if (from != 0) {
    op.since = from;
  }
  const n = await octokit.activity.listNotificationsForAuthenticatedUser(op);
  if (!n.data || !n.data.length) {
    console.log('no notifications');
    return;
  }
  n.data.forEach(async (note) => {
    if (!note.unread) {
      return;
    }
    if (!(["subscribed","state_change","comment"]).includes(note.reason)) {
      return;
    }
    if (note.subject.type == "Issue") {
      try {
      const issue = await octokit.issues.get(parseIssue(note.subject.url));
      if (issue.data && issue.data.state && issue.data.state == 'closed') {
        console.log('auto read ' + note.subject.title);
        await killnote(note.id);
      }
      } catch(e) {
        console.warn("couldn't get issue: ", e);
      }
    } else if (note.subject.type =="PullRequest") {
      try {
      const prstat = await octokit.pulls.get(parsePR(note.subject.url))
      if (prstat.data && prstat.data.state && prstat.data.state != 'open') {
        console.log('auto read ' + note.subject.title);
        await killnote(note.id);
      } else if (prstat.data && note.subject.title.indexOf("chore(deps)") == 0) {
        console.log('auto read ' + note.subject.title);
        await killnote(note.id);
      }
      } catch(e) {
        console.log("couldn't get pr: ", note.subject, e);
      }
    } else if (note.subject.type =="Release") {
    } else {
      console.log(note.subject);
    }
  });
}
