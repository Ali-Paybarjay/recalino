-- NFR-02 / PRD-PRIV-06: queue retention must not erase durable audit records.
-- Completed queue rows can expire; their processing/deletion receipts remain intact.
alter table proc.processing_run drop constraint processing_run_job_id_fkey;
alter table proc.processing_run add constraint processing_run_job_id_fkey
  foreign key (job_id) references plt.job(id) on delete set null;
alter table priv.deletion_request drop constraint deletion_request_job_id_fkey;
alter table priv.deletion_request add constraint deletion_request_job_id_fkey
  foreign key (job_id) references plt.job(id) on delete set null;
