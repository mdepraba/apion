import { Link } from '@tanstack/react-router';

const CRUMB = 'flex min-w-0 items-baseline gap-2';
/* The trail is quieter than where you are, so the current page is what the
   eye lands on in the row. */
const LINK =
  'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-text-muted no-underline hover:text-text hover:underline';
/* Also the page heading, so it carries weight rather than a larger size. */
const CURRENT =
  'm-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-md font-semibold text-text';

/**
 * Projects, then this project, then where you are.
 *
 * Every crumb but the last one is a link, the project included: a person
 * reading the standard, the mock or the members list is one click from the
 * contract rather than having to go out to the project list and back in.
 * `/projects/$slug` resolves whichever version they mean.
 *
 * The last crumb is the page's own heading, so it is passed as text and rendered
 * as `h1` unless the page already has one elsewhere.
 */
export function Breadcrumb({
  project,
  page,
  heading = true,
}: {
  project: { slug: string; name: string };
  /** Where you are. Omitted on the contract itself, which is the project. */
  page?: string;
  /** False where the surrounding page owns its `h1`. */
  heading?: boolean;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex min-w-0 flex-wrap items-baseline gap-2">
        <li className={CRUMB}>
          <Link to="/" className={LINK}>
            Projects
          </Link>
        </li>

        <li className={CRUMB}>
          <Divider />
          {page === undefined ? (
            <span className={CURRENT}>{project.name}</span>
          ) : (
            <Link
              to="/projects/$slug"
              params={{ slug: project.slug }}
              className={LINK}
            >
              {project.name}
            </Link>
          )}
        </li>

        {page !== undefined ? (
          <li className={CRUMB}>
            <Divider />
            {heading ? (
              <h1 className={CURRENT}>{page}</h1>
            ) : (
              <span className={CURRENT}>{page}</span>
            )}
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

function Divider() {
  return (
    <span className="text-text-muted" aria-hidden="true">
      /
    </span>
  );
}
