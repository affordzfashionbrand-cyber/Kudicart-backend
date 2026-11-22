import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface VendorWelcomeEmailDto {
  to: string;
  storeName: string;
  ownerName: string;
  tempPassword: string;
  loginUrl: string;
}

export interface VendorOrderAlertEmailDto {
  to: string;
  storeName: string;
  orderNumber: string;
  orderId: string;
  itemCount: number;
  totalAmount: number;
  portalUrl: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private readonly fromAddress =
    process.env.SMTP_FROM || '"KudiCart Vendor Operations" <no-reply@kudicart.com>';

  constructor() {
    this.initTransporter();
  }

  private async initTransporter() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`Initialized SMTP transport with host ${host}:${port}`);
    } else {
      // In development or when SMTP credentials are not yet populated, use a JSON / mock transport
      // with full console visibility so onboarding is never blocked.
      this.transporter = nodemailer.createTransport({
        jsonTransport: true,
      });
      this.logger.warn(
        'SMTP_HOST / SMTP_USER not set. Using JSON/Mock transport for development emails.',
      );
    }
  }

  async sendVendorWelcomeEmail(dto: VendorWelcomeEmailDto): Promise<boolean> {
    try {
      const subject = `Welcome to KudiCart — Your Vendor Portal Credentials for ${dto.storeName}`;
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f7f5; margin: 0; padding: 20px; }
            .container { max-width: 580px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e4e0db; border-radius: 8px; overflow: hidden; }
            .header { background-color: #111111; color: #ffffff; padding: 24px; text-align: center; }
            .content { padding: 24px; color: #333333; line-height: 1.6; font-size: 14px; }
            .creds-box { background-color: #f4f1ea; border: 1px dashed #d5d0c7; border-radius: 6px; padding: 16px; margin: 20px 0; }
            .creds-row { margin: 8px 0; font-size: 14px; }
            .creds-label { font-weight: 600; color: #6b6667; }
            .creds-val { font-family: monospace; font-weight: 700; color: #111111; font-size: 15px; }
            .btn { display: inline-block; background-color: #ff5a1f; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 16px 0; }
            .footer { background-color: #faf9f6; padding: 16px; text-align: center; font-size: 12px; color: #888888; border-top: 1px solid #e4e0db; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 style="margin: 0; font-weight: 700; letter-spacing: 0.5px;">KudiCart Partner Operations</h2>
            </div>
            <div class="content">
              <p>Dear <strong>${dto.ownerName}</strong>,</p>
              <p>Congratulations! Your boutique store <strong>${dto.storeName}</strong> has been successfully onboarded as an authorized boutique partner on KudiCart.</p>
              <p>You can now manage your catalog, review customer orders, and track your settlements directly from the Vendor Operations Portal.</p>
              
              <div class="creds-box">
                <div class="creds-row"><span class="creds-label">Portal URL:</span> <span class="creds-val">${dto.loginUrl}</span></div>
                <div class="creds-row"><span class="creds-label">Login Email:</span> <span class="creds-val">${dto.to}</span></div>
                <div class="creds-row"><span class="creds-label">Temporary Password:</span> <span class="creds-val">${dto.tempPassword}</span></div>
              </div>

              <p>Please click the button below to sign in. For security purposes, we recommend updating your password upon your first sign in.</p>
              
              <div style="text-align: center;">
                <a href="${dto.loginUrl}" class="btn">Sign In to Vendor Portal</a>
              </div>

              <p style="margin-top: 24px; font-size: 13px; color: #666666;">
                If you have any questions or require assistance setting up your store schedule or adding products, please reach out to our partner support team.
              </p>
            </div>
            <div class="footer">
              &copy; ${new Date().getFullYear()} KudiCart Technologies. All rights reserved.
            </div>
          </div>
        </body>
        </html>
      `;

      if (!this.transporter) await this.initTransporter();

      const info = await this.transporter!.sendMail({
        from: this.fromAddress,
        to: dto.to,
        subject,
        html,
        text: `Welcome to KudiCart, ${dto.ownerName}! Your boutique ${dto.storeName} is ready. Login: ${dto.loginUrl} | User: ${dto.to} | Temp Password: ${dto.tempPassword}`,
      });

      this.logger.log(
        `Sent vendor onboarding welcome email to ${dto.to} (MessageID: ${info.messageId || 'DEV_JSON'})`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to send vendor welcome email to ${dto.to}: ${err.message}`, err.stack);
      return false;
    }
  }

  async sendVendorOrderNotificationEmail(dto: VendorOrderAlertEmailDto): Promise<boolean> {
    try {
      const subject = `[New Order Alert] Order #${dto.orderNumber} placed for ${dto.storeName}`;
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f7f5; margin: 0; padding: 20px; }
            .container { max-width: 580px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e4e0db; border-radius: 8px; overflow: hidden; }
            .header { background-color: #ff5a1f; color: #ffffff; padding: 20px; text-align: center; }
            .content { padding: 24px; color: #333333; line-height: 1.6; font-size: 14px; }
            .highlight-card { background-color: #f4f1ea; border-radius: 6px; padding: 16px; margin: 16px 0; }
            .row { display: flex; justify-content: space-between; margin: 6px 0; }
            .btn { display: inline-block; background-color: #111111; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 16px 0; }
            .footer { background-color: #faf9f6; padding: 16px; text-align: center; font-size: 12px; color: #888888; border-top: 1px solid #e4e0db; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 style="margin: 0;">New Order Received!</h2>
            </div>
            <div class="content">
              <p>Hello <strong>${dto.storeName}</strong> team,</p>
              <p>You have received a new order on KudiCart that requires your confirmation and preparation.</p>

              <div class="highlight-card">
                <div class="row"><strong>Order Reference:</strong> <span>#${dto.orderNumber}</span></div>
                <div class="row"><strong>Items Count:</strong> <span>${dto.itemCount} item(s)</span></div>
                <div class="row"><strong>Order Value:</strong> <span>₹${dto.totalAmount.toFixed(2)}</span></div>
              </div>

              <p>Please log in to your Vendor Portal to review the order items and accept the order so preparation can begin.</p>

              <div style="text-align: center;">
                <a href="${dto.portalUrl}" class="btn">View & Accept Order</a>
              </div>
            </div>
            <div class="footer">
              &copy; ${new Date().getFullYear()} KudiCart Technologies. All rights reserved.
            </div>
          </div>
        </body>
        </html>
      `;

      if (!this.transporter) await this.initTransporter();

      await this.transporter!.sendMail({
        from: this.fromAddress,
        to: dto.to,
        subject,
        html,
        text: `New order #${dto.orderNumber} received for ${dto.storeName}. Value: ₹${dto.totalAmount}. Check portal: ${dto.portalUrl}`,
      });

      this.logger.log(`Sent new order alert email to vendor at ${dto.to} for order #${dto.orderNumber}`);
      return true;
    } catch (err: any) {
      this.logger.error(
        `Failed to send vendor order notification email to ${dto.to}: ${err.message}`,
        err.stack,
      );
      return false;
    }
  }
}
