-- One summary is written automatically per upload (3 a month), plus up to 3 rewrites when
-- recategorising has changed the figures a summary quotes. Still bounded by the global daily cap.
alter table private.limits alter column monthly_insights_per_user set default 6;
update private.limits set monthly_insights_per_user = 6;
