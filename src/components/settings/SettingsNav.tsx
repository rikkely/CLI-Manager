export interface SettingsNavTab<T extends string> {
  id: T;
  label: string;
}

interface SettingsNavProps<T extends string> {
  tabs: SettingsNavTab<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
}

export function SettingsNav<T extends string>({ tabs, activeTab, onChange }: SettingsNavProps<T>) {
  return (
    <aside className="ui-surface-low flex w-[220px] shrink-0 flex-col border-r border-border p-3">
      <span className="px-2 pb-3 text-[12px] font-semibold tracking-[0.04em] text-on-surface-variant">
        设置
      </span>
      <nav className="ui-no-divider-list">
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`ui-interactive whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm ${
                active ? "font-semibold text-on-surface" : "font-medium text-on-surface-variant"
              }`}
              style={
                active
                  ? {
                      backgroundColor: "var(--interactive-selected-bg)",
                      boxShadow: "inset 0 0 0 1px var(--interactive-selected-border)",
                    }
                  : undefined
              }
              aria-pressed={active}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
