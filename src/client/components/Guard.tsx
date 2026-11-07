/** Small error boundary: one broken widget must never blank the panel. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { getReact } from "../runtime.js";
import { FALLBACK_T } from "../helpers.js";

export type Translator = (key: string) => string;

export interface GuardProps {
  t?: Translator;
  children?: ReactNode;
}

let CachedGuard: any = null;

function makeGuard() {
  const React = getReact();
  return class DeviceXGuard extends React.Component {
    constructor(props: any) {
      super(props);
      this.state = { failed: false };
      this.retry = this.retry.bind(this);
    }
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error: any, info: any) {
      try {
        console.error("[devicex] widget failed:", error, info);
      } catch (_ignored) {
        /* ignore logging failures */
      }
    }
    retry() {
      this.setState({ failed: false });
    }
    render() {
      if (this.state.failed) {
        const t = typeof this.props.t === "function" ? this.props.t : FALLBACK_T;
        return (
          <div className="dx-guard" role="alert">
            <p className="dx-guardTitle">{t("guard.title")}</p>
            <button type="button" className="dx-btn" onClick={this.retry}>
              {t("guard.retry")}
            </button>
          </div>
        );
      }
      return this.props.children;
    }
  };
}

export function Guard(props: GuardProps) {
  if (CachedGuard === null) CachedGuard = makeGuard();
  return <CachedGuard t={props.t}>{props.children}</CachedGuard>;
}
