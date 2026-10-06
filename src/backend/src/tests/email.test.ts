import { sendEmail, sendDeletionConfirmationEmail } from '../services/emailService';

describe('Email Service Integration Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should send email using fallback simulation when SMTP is unconfigured', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.EMAIL_FROM = 'test-from@capitalfm.africa';
    process.env.EMAIL_FROM_NAME = 'Capital FM Test Sender';
    process.env.REPLY_TO = 'test-reply@capitalfm.africa';

    const result = await sendEmail({
      to: 'listener@capitalfm.africa',
      subject: 'Test Subject',
      text: 'Test Text Content',
      html: '<p>Test HTML Content</p>',
    });

    expect(result).toBe(true);
  });

  it('should send deletion confirmation email successfully', async () => {
    process.env.EMAIL_FROM = 'no-reply@capitalfm.africa';
    process.env.EMAIL_FROM_NAME = 'Capital FM 98.4';
    process.env.REPLY_TO = 'support@capitalfm.africa';

    const result = await sendDeletionConfirmationEmail(
      'user@capitalfm.africa',
      'capitalfm://delete-account?token=xyz123'
    );

    expect(result).toBe(true);
  });
});
