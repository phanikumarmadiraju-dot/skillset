const test = require("node:test");
const assert = require("node:assert/strict");
const { buildEmail, hasSkill, matchesExperience, rankJobs } = require("./daily-digest");

test("matches a selected skill as a whole word or phrase", () => {
  assert.equal(hasSkill("Senior AWS and Kubernetes engineer", "AWS"), true);
  assert.equal(hasSkill("Senior AWS and Kubernetes engineer", "Kubernetes"), true);
  assert.equal(hasSkill("A website for awsomeness", "AWS"), false);
  assert.equal(hasSkill("CI/CD platform engineer", "CICD"), true);
});

test("matches experience bounds against stated intervals and retains unstated requirements", () => {
  assert.equal(matchesExperience({ title: "Engineer", description: "Requires 3-5 years experience" }, 4, 6), true);
  assert.equal(matchesExperience({ title: "Engineer", description: "Requires 1 year experience" }, 4, 6), false);
  assert.equal(matchesExperience({ title: "Engineer", description: "Experience is not stated" }, 4, 6), true);
});

test("ranks, filters, deduplicates, and caps matching jobs", () => {
  const jobs = Array.from({ length: 22 }, (_, index) => ({
    id: `job-${index}`,
    title: index % 2 === 0 ? "AWS SRE" : "AWS engineer",
    description: index % 2 === 0 ? "AWS SRE with 4 years experience" : "AWS only, 4 years experience",
  }));
  jobs.push({ ...jobs[0], title: "duplicate record" });
  jobs.push({ id: "out-of-range", title: "AWS SRE", description: "10 years experience" });
  jobs.push({ id: "no-skill", title: "Developer", description: "4 years experience" });

  const ranked = rankJobs(jobs, ["AWS", "SRE"], 3, 5);
  assert.equal(ranked.length, 20);
  assert.equal(ranked[0].score, 100);
  assert.equal(ranked.at(-1).score, 50);
  assert.equal(new Set(ranked.map((job) => job.id)).size, 20);
});

test("includes the no-results outcome and criteria in the email", () => {
  const email = buildEmail([], ["AWS"], "SRE", "", null, null);
  assert.match(email.text, /No matching jobs were found today/);
  assert.match(email.html, /Role: SRE/);
});
