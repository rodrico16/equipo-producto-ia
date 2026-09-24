export class GitHubPublicationAuthError extends Error {
  readonly stage: "push" | "pull_request";
  readonly reason: "expired" | "permission";

  constructor(stage: "push" | "pull_request", reason: "expired" | "permission") {
    super(reason === "expired"
      ? "La autorización de GitHub venció. Reconectá GitHub y volvé a ejecutar el pedido para publicar el PR."
      : "GitHub rechazó la publicación por falta de permisos. Reconectá GitHub y autorizá el repositorio con permisos de escritura para contenido y Pull Requests; después volvé a ejecutar el pedido.");
    this.name = "GitHubPublicationAuthError";
    this.stage = stage;
    this.reason = reason;
  }
}

export function pushAuthFailure(stderr: string): "expired" | "permission" | null {
  if (/(authentication failed|invalid credentials|bad credentials|401|could not read username)/i.test(stderr)) return "expired";
  if (/(403|permission denied|write access.*not granted|not permitted to push|not allowed to push|insufficient permission|resource not accessible by integration|denied to .*\b403\b)/i.test(stderr)) return "permission";
  return null;
}

export function apiAuthFailure(status: number, message = ""): "expired" | "permission" | null {
  if (status === 401 || /bad credentials/i.test(message)) return "expired";
  if (status === 403 || /resource not accessible by integration|must have .* permission/i.test(message)) return "permission";
  return null;
}
