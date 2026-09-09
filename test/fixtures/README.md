# Community discussion HTML fixtures

These are reduced, anonymized HTML examples for offline tests, not full archival copies.
They retain selectors observed on anonymously readable Steam pages. Text, counts, and IDs
are edited to keep the examples small. In particular, the two-reply page size is synthetic;
the parser reads Steam's embedded page size rather than assuming a fixed value.

Public sources inspected during implementation:

- Search, duplicate matching posts, and paging: https://steamcommunity.com/app/620/discussions/search/?q=crash&sort=time
- Empty search indicator: https://steamcommunity.com/app/620/discussions/search/?q=zzzxqv120nomatch846291&sort=time
- Thread opener and replies: https://steamcommunity.com/app/620/discussions/0/4514379914249040961/?ctp=1
- Developer opener: https://steamcommunity.com/app/1145360/discussions/0/1639794468039501668/?ctp=1
- Developer reply: https://steamcommunity.com/app/1145360/discussions/0/2568689796942265505/?ctp=1
- Moderator reply and long-thread pagination: https://steamcommunity.com/app/427520/discussions/0/2592234299545022370/?ctp=2
- Steam's public `forums.js` and `global.js` describe the `p` search and `ctp` thread page parameters, and the `InitializeCommentThread` data.

Blocked-page, deleted-post, and incomplete-markup fixtures are synthetic failure scenarios.
No restricted pages were accessed to obtain them. Unknown page layouts must remain explicitly
unavailable rather than becoming successful empty results. Tests mutate the saved examples
to cover size limits, mismatched identifiers, missing replies, and out-of-range pages.

Automated tests load only these local fixtures and mock HTTP calls. They do not contact Steam.
