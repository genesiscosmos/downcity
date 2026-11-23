/** `@downcity/powers/email` 独立入口：通用 IMAP/SMTP 邮件能力及配置协议。 */
export { EmailPower } from "./email/Power.js";
export type {
  EmailAccount,
  EmailServer,
  EmailIdentity,
  EmailListInput,
  EmailSendInput,
  EmailReplyInput,
  EmailAccountView,
  EmailServerView,
} from "./email/types/Email.js";
