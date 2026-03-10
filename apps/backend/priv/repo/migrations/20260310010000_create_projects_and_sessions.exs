defmodule OnlookBackend.Repo.Migrations.CreateProjectsAndSessions do
  use Ecto.Migration

  def change do
    create table(:projects, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :framework, :string, null: false
      add :source, :text, null: false

      timestamps(type: :utc_datetime)
    end

    create table(:sessions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :client_id, :string, null: false
      add :status, :string, null: false, default: "active"
      add :project_id, references(:projects, type: :binary_id, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime)
    end

    create index(:sessions, [:project_id])
  end
end
