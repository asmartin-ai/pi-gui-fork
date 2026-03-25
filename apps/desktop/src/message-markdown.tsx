import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MessageMarkdown({ text }: { readonly text: string }) {
  return (
    <div className="message__content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children }) => {
            const language = className?.replace(/^language-/, "");
            const code = String(children).replace(/\n$/, "");
            if (!className) {
              return <code>{code}</code>;
            }
            return (
              <pre data-language={language}>
                <code className={className}>{code}</code>
              </pre>
            );
          },
          a: ({ href, children }) => (
            <a href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
