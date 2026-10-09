-- 3 statement uploads per user per month (was 5). One statement per account per month is the
-- normal case; 3 leaves room for, say, a bank account plus a credit card and one retry.
alter table private.limits alter column monthly_uploads_per_user set default 3;
update private.limits set monthly_uploads_per_user = 3;
