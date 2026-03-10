defmodule OnlookBackend.Studio do
  @moduledoc false

  import Ecto.Query, warn: false

  alias OnlookBackend.Repo
  alias OnlookBackend.Studio.Project
  alias OnlookBackend.Studio.Session

  def create_project(attrs) do
    %Project{}
    |> Project.changeset(attrs)
    |> Repo.insert()
  end

  def get_project(id) do
    Repo.get(Project, id)
  end

  def get_project!(id) do
    Repo.get!(Project, id)
  end

  def update_project(%Project{} = project, attrs) do
    project
    |> Project.changeset(attrs)
    |> Repo.update()
  end

  def create_session(attrs) do
    %Session{}
    |> Session.changeset(attrs)
    |> Repo.insert()
  end

  def list_project_sessions(project_id) do
    Session
    |> where([session], session.project_id == ^project_id)
    |> order_by([session], desc: session.inserted_at)
    |> Repo.all()
  end
end
