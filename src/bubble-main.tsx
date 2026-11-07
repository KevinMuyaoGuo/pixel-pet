import React from 'react';
import { createRoot } from 'react-dom/client';
import type { BubbleState } from '../electron/pet-state';
import './bubble.css';

function Bubble() {
  const [state, setState] = React.useState<BubbleState>({ message: null, placement: 'above' });
  React.useEffect(() => {
    let active = true;
    void window.bubbleBridge.getState().then((value) => { if (active) setState(value); });
    const unsubscribe = window.bubbleBridge.onState(setState);
    return () => { active = false; unsubscribe(); };
  }, []);
  return state.message ? <div className="speech-bubble" data-placement={state.placement} role="status">{state.message}</div> : null;
}

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><Bubble /></React.StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
