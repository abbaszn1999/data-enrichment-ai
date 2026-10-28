-- Private bucket for Store Agent chat files: user attachments and everything
-- the agent creates (reports, tables, generated images). Paths are
-- {workspaceId}/{chatId}/{relativePath}. No policies: the gateway hands out
-- short-lived signed URLs after checking the chat belongs to the user, and
-- the agent service writes with the service role.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('store-agent-files', 'store-agent-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;
