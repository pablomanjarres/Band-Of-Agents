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
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">Something went wrong rendering this view.</p>
          <p className="mt-1 break-all font-mono text-xs">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
