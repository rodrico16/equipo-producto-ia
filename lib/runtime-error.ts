const sessionIdleTimeoutPattern = /Timeout after \d+ms waiting for session\.idle/i;

export function presentRuntimeError(message: string, fallback: string) {
  if (sessionIdleTimeoutPattern.test(message)) {
    return "Copilot tardó demasiado en completar este turno. El trabajo puede haber quedado a medias; revisá el estado del repositorio antes de reintentar. Si vuelve a ocurrir, probá reducir el alcance del pedido o usar un modelo más rápido.";
  }
  return message || fallback;
}
