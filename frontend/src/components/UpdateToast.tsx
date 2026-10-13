import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Toast de atualização do PWA. Com registerType 'prompt' o navegador já baixa a
 * nova versão em silêncio; aqui só avisamos e deixamos quem decide recarregar.
 * Resolve o "mudou mas não apareceu": em vez de autoUpdate recarregar sozinha
 * (ou servir bundle velho sem sinal), o usuário clica e pega a versão nova.
 */
export function UpdateToast() {
  const [updateSW, setUpdateSW] = useState<(() => void) | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const apply = registerSW({
      onNeedRefresh: () => setAvailable(true),
      onOfflineReady: () => undefined,
    });
    setUpdateSW(() => apply);
    return () => {
      void apply();
    };
  }, []);

  if (!available || !updateSW) return null;

  return (
    <div className="update-toast" role="status" aria-live="polite">
      <span className="update-toast__text">✦ Nova versão disponível.</span>
      <button type="button" className="button button--sm button--primary" onClick={updateSW}>
        Atualizar
      </button>
    </div>
  );
}
