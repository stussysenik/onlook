defmodule OnlookBackendWeb.ProjectController do
  use OnlookBackendWeb, :controller

  alias OnlookBackend.Studio

  def create(conn, %{"project" => project_params}) do
    case Studio.create_project(project_params) do
      {:ok, project} ->
        conn
        |> put_status(:created)
        |> json(%{data: project_payload(project)})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: translate_errors(changeset)})
    end
  end

  def show(conn, %{"id" => id}) do
    case Studio.get_project(id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{errors: %{detail: "Project not found"}})

      project ->
        json(conn, %{data: project_payload(project)})
    end
  end

  def update(conn, %{"id" => id, "project" => project_params}) do
    case Studio.get_project(id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{errors: %{detail: "Project not found"}})

      project ->
        case Studio.update_project(project, project_params) do
          {:ok, updated_project} ->
            json(conn, %{data: project_payload(updated_project)})

          {:error, changeset} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{errors: translate_errors(changeset)})
        end
    end
  end

  defp project_payload(project) do
    %{
      id: project.id,
      name: project.name,
      framework: project.framework,
      source: project.source,
      inserted_at: project.inserted_at,
      updated_at: project.updated_at
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
