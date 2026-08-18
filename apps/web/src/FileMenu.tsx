import { useEffect, useRef, useState } from "react";

interface FileMenuProps {
  documentTitle: string;
  onDownload: () => void;
  onNew: () => Promise<void>;
  onOpen: (file: File) => Promise<void>;
  onSave: () => Promise<void>;
}

export function markdownFilename(title: string): string {
  const withoutControlCharacters = Array.from(title.trim())
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("");
  const stem = withoutControlCharacters
    .replace(/\.md$/i, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return `${stem || "untitled"}.md`;
}

export function FileMenu({
  documentTitle,
  onDownload,
  onNew,
  onOpen,
  onSave,
}: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void onSave().catch(() => undefined);
      } else if (key === "o") {
        event.preventDefault();
        inputRef.current?.click();
      } else if (key === "n") {
        event.preventDefault();
        void onNew().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [onNew, onSave]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const run = (action: () => void | Promise<void>) => {
    setOpen(false);
    void Promise.resolve(action()).catch(() => undefined);
  };

  return (
    <div className="file-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="menu-trigger"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        File <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div aria-label="File operations" className="menu-popover" role="menu">
          <button onClick={() => run(onNew)} role="menuitem" type="button">
            <span>New document</span>
            <kbd>Ctrl N</kbd>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              inputRef.current?.click();
            }}
            role="menuitem"
            type="button"
          >
            <span>Open Markdown…</span>
            <kbd>Ctrl O</kbd>
          </button>
          <hr />
          <button onClick={() => run(onSave)} role="menuitem" type="button">
            <span>Save locally</span>
            <kbd>Ctrl S</kbd>
          </button>
          <button onClick={() => run(onDownload)} role="menuitem" type="button">
            <span>Download {markdownFilename(documentTitle)}</span>
          </button>
        </div>
      ) : null}
      <input
        accept=".md,.markdown,text/markdown,text/plain"
        aria-label="Open Markdown file"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onOpen(file).catch(() => undefined);
        }}
        ref={inputRef}
        type="file"
      />
    </div>
  );
}
