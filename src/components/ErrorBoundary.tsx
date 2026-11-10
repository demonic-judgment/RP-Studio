import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("界面渲染异常", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-bg px-6">
        <div className="w-full max-w-[440px] rounded-3xl border border-line bg-surface p-6 text-center shadow-card">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 text-lg">
            ⚠️
          </div>
          <h1 className="text-[16px] font-semibold text-fg">界面出现异常</h1>
          <p className="mt-2 break-words text-[12.5px] leading-relaxed text-fg-muted">
            {this.state.error.message}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle">
            数据仍保存在本地数据库中，重新加载不会丢失。
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="h-10 flex-1 rounded-xl border border-line text-[13px] font-medium text-fg transition-colors hover:bg-surface-2"
            >
              返回界面
            </button>
            <button
              onClick={() => window.location.reload()}
              className="h-10 flex-1 rounded-xl bg-primary text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-hover"
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
