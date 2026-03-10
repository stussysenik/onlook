defmodule OnlookBackend.Studio.Session do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "sessions" do
    field :client_id, :string
    field :status, :string, default: "active"

    belongs_to :project, OnlookBackend.Studio.Project

    timestamps(type: :utc_datetime)
  end

  def changeset(session, attrs) do
    session
    |> cast(attrs, [:client_id, :project_id, :status])
    |> validate_required([:client_id, :project_id])
    |> put_default_status()
    |> validate_length(:client_id, min: 1, max: 120)
    |> foreign_key_constraint(:project_id)
  end

  defp put_default_status(changeset) do
    case get_field(changeset, :status) do
      nil -> put_change(changeset, :status, "active")
      _value -> changeset
    end
  end
end
