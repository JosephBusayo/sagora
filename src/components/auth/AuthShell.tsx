import Image from "next/image";

type Props = {
  /** Photo shown in the rounded panel (decorative). */
  image: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

/** Split layout used by every sign-up / sign-in screen: form left, photo right. */
export function AuthShell({ image, title, subtitle, children, footer }: Props) {
  return (
    <div className="auth">
      <main className="auth__main">
        <div className="auth__form-col">
          <Image
            className="auth__logo"
            src="/brand/logo-mark.svg"
            alt="Sagora"
            width={70}
            height={65}
            priority
          />
          <header className="auth__head">
            <h1 className="auth__title">{title}</h1>
            <p className="auth__subtitle">{subtitle}</p>
          </header>
          {children}
          {/* A div, not a p: a footer may hold a sign-out form, and a form inside a p is invalid
              HTML that the browser moves, which breaks hydration. */}
          {footer ? <div className="auth__footer">{footer}</div> : null}
        </div>
      </main>
      <aside className="auth__panel" aria-hidden="true">
        <Image src={image} alt="" fill priority sizes="(max-width: 960px) 0px, 47vw" style={{ objectFit: "cover" }} />
      </aside>
    </div>
  );
}
