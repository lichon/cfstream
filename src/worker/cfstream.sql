--
-- PostgreSQL database dump
--

\restrict mk2HChqqtrWLhG4d9AFOBLc2GLMhhavqwnqZ5PoKc6uxEN7zQeeg1a51qiwq2Wj

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: cfstream; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA cfstream;


ALTER SCHEMA cfstream OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: rooms; Type: TABLE; Schema: cfstream; Owner: postgres
--

CREATE TABLE cfstream.rooms (
    name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stream_id text
);


ALTER TABLE cfstream.rooms OWNER TO postgres;

--
-- Name: secrets; Type: TABLE; Schema: cfstream; Owner: postgres
--

CREATE TABLE cfstream.secrets (
    id text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    secret text NOT NULL
);


ALTER TABLE cfstream.secrets OWNER TO postgres;

--
-- Name: signals; Type: TABLE; Schema: cfstream; Owner: postgres
--

CREATE TABLE cfstream.signals (
    sid text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    offer text,
    answer text
);


ALTER TABLE cfstream.signals OWNER TO postgres;

--
-- Name: subs; Type: TABLE; Schema: cfstream; Owner: postgres
--

CREATE TABLE cfstream.subs (
    id text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sub_sid text NOT NULL
);


ALTER TABLE cfstream.subs OWNER TO postgres;


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: cfstream; Owner: postgres
--

ALTER TABLE ONLY cfstream.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (name);


--
-- Name: secrets secrets_pkey; Type: CONSTRAINT; Schema: cfstream; Owner: postgres
--

ALTER TABLE ONLY cfstream.secrets
    ADD CONSTRAINT secrets_pkey PRIMARY KEY (id);


--
-- Name: signals signals_pkey; Type: CONSTRAINT; Schema: cfstream; Owner: postgres
--

ALTER TABLE ONLY cfstream.signals
    ADD CONSTRAINT signals_pkey PRIMARY KEY (sid);


--
-- Name: subs subs_pkey; Type: CONSTRAINT; Schema: cfstream; Owner: postgres
--

ALTER TABLE ONLY cfstream.subs
    ADD CONSTRAINT subs_pkey PRIMARY KEY (id, sub_sid);


--
-- Name: rooms Policy with security definer functions; Type: POLICY; Schema: cfstream; Owner: postgres
--

CREATE POLICY "Policy with security definer functions" ON cfstream.rooms TO authenticated USING (true);


--
-- Name: rooms; Type: ROW SECURITY; Schema: cfstream; Owner: postgres
--

ALTER TABLE cfstream.rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: secrets; Type: ROW SECURITY; Schema: cfstream; Owner: postgres
--

ALTER TABLE cfstream.secrets ENABLE ROW LEVEL SECURITY;

--
-- Name: signals; Type: ROW SECURITY; Schema: cfstream; Owner: postgres
--

ALTER TABLE cfstream.signals ENABLE ROW LEVEL SECURITY;

--
-- Name: subs; Type: ROW SECURITY; Schema: cfstream; Owner: postgres
--

ALTER TABLE cfstream.subs ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA cfstream; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA cfstream TO service_role;


--
-- Name: TABLE rooms; Type: ACL; Schema: cfstream; Owner: postgres
--

GRANT ALL ON TABLE cfstream.rooms TO service_role;


--
-- Name: TABLE secrets; Type: ACL; Schema: cfstream; Owner: postgres
--

GRANT ALL ON TABLE cfstream.secrets TO service_role;


--
-- Name: TABLE signals; Type: ACL; Schema: cfstream; Owner: postgres
--

GRANT ALL ON TABLE cfstream.signals TO service_role;


--
-- Name: TABLE subs; Type: ACL; Schema: cfstream; Owner: postgres
--

GRANT ALL ON TABLE cfstream.subs TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict mk2HChqqtrWLhG4d9AFOBLc2GLMhhavqwnqZ5PoKc6uxEN7zQeeg1a51qiwq2Wj

