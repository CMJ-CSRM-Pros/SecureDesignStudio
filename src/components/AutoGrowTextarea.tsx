import { useEffect, useLayoutEffect, useRef } from "react";

// Single-line-looking textarea that grows vertically as the user adds
// explicit newlines. Uses rows={1} so the resting height matches a normal
// <input>, then resets to scrollHeight on every value change.
export interface AutoGrowTextareaProps
  extends Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "rows" | "ref"
  > {
  value: string;
}

export function AutoGrowTextarea(props: AutoGrowTextareaProps) {
  const { value, className, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el || el.offsetParent === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    resize();
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width <= 0 || width === lastWidth) return;
      lastWidth = width;
      resize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={`ps-autogrow-textarea${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}
