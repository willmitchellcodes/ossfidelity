// GraphQL queries OSS Fidelity sends to GitHub. Kept in one file because the
// optional proxy (proxy/worker.js) only forwards queries that appear here, word for word.

// Code review, the way OpenSSF Scorecard checks it: look at the latest changes on the
// default branch and ask whether each one arrived through a pull request that someone
// other than its author approved or merged. A change pushed straight to the branch has
// no pull request, so it counts as unreviewed.
export const CODE_REVIEW_QUERY = "query($o:String!,$r:String!){repository(owner:$o,name:$r){defaultBranchRef{name target{... on Commit{history(first:30){nodes{oid author{name email user{login}} associatedPullRequests(first:3){nodes{number merged author{login __typename} mergedBy{login __typename} reviews(states:APPROVED,first:5){nodes{author{login __typename}}}}}}}}}}}}";

export const ALLOWED_QUERIES = new Set([CODE_REVIEW_QUERY]);
