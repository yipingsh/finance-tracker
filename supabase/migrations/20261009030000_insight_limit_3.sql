-- Monthly summaries are now written automatically after each upload, so their limit matches
-- the upload limit: one summary per upload (was 10, when summaries were an on-demand button).
alter table private.limits alter column monthly_insights_per_user set default 3;
update private.limits set monthly_insights_per_user = 3;
