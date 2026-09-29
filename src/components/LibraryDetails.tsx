import { useLibraries } from "../libraries/LibraryProvider";
import { safeNavigationHref } from "../urlSafety";

export function LibrarySummary() {
  const { statuses } = useLibraries();
  const loaded = statuses.filter(status => status.state === "loaded").length;
  return <span>{statuses.length === 0 ? "No optional libraries configured"
    : `${loaded} loaded; ${statuses.length - loaded} unavailable or rejected`}</span>;
}

export function LibraryDetails() {
  const libraries = useLibraries();
  return <div className="ps-library-details">
    <p role="status"><LibrarySummary /></p>
    <p>Libraries are explicitly selected by the developer or deployer at startup.
      They do not grant access, sign you in, or enable collaboration or AI.
      This is not an internal/public mode switch.</p>
    <p>Core catalogs and rules remain available; optional libraries can add authoring choices. This checkpoint is
      not a public-content release. Profile preferences and saved model definitions take precedence.</p>
    <details>
      <summary>Built-in contributions</summary>
      <p>{libraries.coreRuleIds.length} finding kinds; authentication, classifications, node types,
        tenants, boundaries and deviation catalogs; Inventory ID and EndpointRegex fields.</p>
      <ul>{libraries.coreRuleIds.map(id => <li key={id}><code>{id}</code></li>)}</ul>
    </details>
    {libraries.statuses.map((status, index) => <section className="ps-library-card" key={index}>
      <h3>{status.identity?.name ?? status.source}</h3>
      <p><strong>{status.state}</strong> - {status.source}</p>
      {status.identity && <p><code>{status.identity.id}</code> @ {status.identity.version}; core API 1</p>}
      {status.message && <p>{status.message} No contributions from this package were activated.</p>}
      {status.state === "loaded" && <details>
        <summary>{status.contributions.length} contributions and provenance</summary>
        <ul>{status.contributions.map(key => <li key={key}><code>{key}</code>
          {libraries.provenance[key] !== status.identity?.id && <> (overlaid by {libraries.provenance[key]})</>}
        </li>)}</ul>
      </details>}
    </section>)}
    {libraries.fields.filter(field => field.library).map(field => <section key={field.id}>
      <h3>Field: {field.label}</h3>
      <p><code>{field.id}</code>; {field.target}; storage: {field.storage}</p>
      {field.validation && <p>Validation: {field.validation}</p>}
      {field.description && <p>{field.description}</p>}
    </section>)}
    {libraries.rules.map(rule => <section key={rule.id}>
      <h3>Rule: {rule.title}</h3>
      <p><code>{rule.id}</code>; {rule.target}; {rule.check} check on <code>{rule.fieldId}</code></p>
      <p>{rule.description}</p>
    </section>)}
    {libraries.help.map(help => <section key={help.id}>
      <h3>{help.title}</h3>
      <p className="ps-library-help">{help.text}</p>
      {help.url && safeNavigationHref(help.url) && <a href={help.url} target="_blank" rel="noopener noreferrer">Open library guidance</a>}
    </section>)}
    <p>V1 packages contain JSON data and declarative required/GUID checks only.
      Scripts, modules, arbitrary expressions and remote installation are unsupported.
      Change the deployment configuration and restart/rebuild to change libraries.
      Do not put credentials or private content in a distributable package.</p>
  </div>;
}
