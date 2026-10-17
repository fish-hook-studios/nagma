import { Component, type ReactNode } from "react";

// Keeps one broken part of the editor from blanking the whole app: the rest keeps working and
// the failed part offers to try again.
export class ErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        console.error(`${this.props.name} crashed`, error);
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div role="alert" className="m-2 rounded-md border border-panel-border bg-panel p-3 text-[11px] text-ink-muted">
                <p>The {this.props.name} hit a problem.</p>
                <button type="button" onClick={() => this.setState({ error: null })} className="mt-2 rounded bg-field px-2 py-1 text-ink hover:bg-panel-hover">
                    Reload {this.props.name}
                </button>
            </div>
        );
    }
}
