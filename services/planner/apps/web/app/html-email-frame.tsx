"use client";

export interface HtmlEmailFrameProps {
  html: string;
}

/**
 * Renderiza o HTML de um e-mail de verdade (formatacao, tabelas, cores) sem
 * correr o risco de rodar script embutido: `sandbox` sem "allow-scripts"
 * bloqueia qualquer JS do e-mail, independente do conteudo -- "allow-popups"
 * so deixa links com target=_blank abrirem em nova aba.
 *
 * Altura fixa com scroll interno em vez de tentar auto-ajustar: muitos
 * templates de e-mail forcam `html,body{height:100%}` no CSS, o que torna
 * a medida de scrollHeight circular (sempre reflete a altura que a gente
 * ja deu ao iframe, nunca o conteudo real) -- nao vale a pena perseguir
 * pixel-perfect aqui quando o email ja fica legivel com scroll.
 */
export default function HtmlEmailFrame({ html }: HtmlEmailFrameProps) {
  return (
    <iframe
      title="Conteúdo do e-mail"
      srcDoc={html}
      sandbox="allow-popups"
      style={{ width: "100%", height: 420, border: "1px solid var(--color-divider)", background: "#fff", borderRadius: "var(--radius-sm)" }}
    />
  );
}
