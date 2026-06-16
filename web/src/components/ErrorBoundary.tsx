import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Keeps a render error from blanking the whole app: shows the message instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI render error:', error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-danger/30 bg-danger/[0.07] p-4 text-sm text-danger">
          <p className="font-semibold">Something went wrong rendering this view.</p>
          <p className="mt-1 break-all font-mono text-xs text-danger/80">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
