-- Internal operator API only; Data API roles retain no schema/table privileges.
grant insert, update on src.input_contract to recalino_app;
