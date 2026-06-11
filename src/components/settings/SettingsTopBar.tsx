import { TextInput } from "@mantine/core";
import { Search } from "../icons";

interface SettingsTopBarProps {
  title: string;
  description: string;
  searchValue: string;
  searchPlaceholder?: string;
  onSearchChange: (nextValue: string) => void;
  onClose: () => void;
}

export function SettingsTopBar({
  title,
  description,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  onClose,
}: SettingsTopBarProps) {
  return (
    <header className="ui-surface-base ui-glass z-10 border-b border-border px-4 py-3 min-[1280px]:px-6 min-[1280px]:py-4">
      <div className="flex flex-col gap-3 min-[1280px]:flex-row min-[1280px]:items-start min-[1280px]:justify-between min-[1280px]:gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-on-surface min-[1280px]:text-xl">{title}</h2>
          <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant min-[1280px]:text-sm">{description}</p>
        </div>
        <div className="flex w-full items-center justify-end gap-2 min-[1280px]:w-auto min-[1280px]:shrink-0">
          {searchPlaceholder && (
            <TextInput
              value={searchValue}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              size="xs"
              leftSection={<Search size={14} strokeWidth={1.75} />}
              aria-label="设置搜索"
              className="min-w-0 flex-1 min-[1280px]:w-56 min-[1280px]:flex-none"
            />
          )}
          <button
            onClick={onClose}
            className="ui-interactive shrink-0 rounded-xl border px-2.5 py-1.5 text-xs font-medium"
            style={{
              borderColor: "color-mix(in srgb, var(--primary) 38%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--primary) 8%, transparent)",
              color: "var(--primary)",
            }}
            aria-label="关闭设置窗口"
          >
            关闭
          </button>
        </div>
      </div>
    </header>
  );
}
