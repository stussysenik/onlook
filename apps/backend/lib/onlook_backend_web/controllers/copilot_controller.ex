defmodule OnlookBackendWeb.CopilotController do
  use OnlookBackendWeb, :controller

  alias OnlookBackend.AI

  def create(conn, params) do
    case AI.request_edits(params) do
      {:ok, payload} ->
        json(conn, %{data: payload})

      {:error, {:invalid_request, message}} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: %{detail: message}})

      {:error, {:config, message}} ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{errors: %{detail: message}})

      {:error, {:provider, message}} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{errors: %{detail: message}})

      {:error, {:upstream, message}} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{errors: %{detail: message}})

      {:error, {:invalid_response, message}} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{errors: %{detail: message}})
    end
  end
end
