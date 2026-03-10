defmodule OnlookBackendWeb.SessionController do
  use OnlookBackendWeb, :controller

  alias OnlookBackend.Studio

  def index(conn, %{"project_id" => project_id}) do
    sessions =
      project_id
      |> Studio.list_project_sessions()
      |> Enum.map(&session_payload/1)

    json(conn, %{data: sessions})
  end

  def create(conn, %{"session" => session_params}) do
    case Studio.create_session(session_params) do
      {:ok, session} ->
        conn
        |> put_status(:created)
        |> json(%{data: session_payload(session)})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: translate_errors(changeset)})
    end
  end

  defp session_payload(session) do
    %{
      id: session.id,
      project_id: session.project_id,
      client_id: session.client_id,
      status: session.status,
      inserted_at: session.inserted_at,
      updated_at: session.updated_at
    }
  end

  defp translate_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, opts} ->
      Regex.replace(~r"%{(\w+)}", message, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
