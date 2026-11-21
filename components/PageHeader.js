// The one header every page uses: a title, an optional one-line subtitle, and the
// page's own actions on the right. Navigation (where you are, other sections) lives in
// the Nav and its project bar — never here.
export default function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {subtitle && <p className="page-head-sub">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  )
}
