export const GOOGLE_LOGIN_CHANNEL = "mailflow-google-login";

export function googleLoginError(error?: string) {
  switch (error) {
    case "access_denied":
      return "Google access was canceled. Please log in again and allow Gmail access to continue.";
    case "oauth_not_configured":
      return "Google login has not been set up for this application yet. The MailFlow team needs to enable it before you can sign in.";
    case "invalid_oauth_state":
      return "Your login attempt expired or could not be verified. Please try again.";
    default:
      return "Google login could not be completed. Please try again.";
  }
}
