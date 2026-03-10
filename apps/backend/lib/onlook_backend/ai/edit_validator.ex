defmodule OnlookBackend.AI.EditValidator do
  @moduledoc false

  def collect_node_ids(%{"root" => root}) when is_map(root) do
    collect_node_ids(root)
  end

  def collect_node_ids(%{"id" => id, "children" => children})
      when is_binary(id) and is_list(children) do
    Enum.reduce_while(children, {:ok, MapSet.new([id])}, fn child, {:ok, acc} ->
      case collect_node_ids(child) do
        {:ok, child_ids} -> {:cont, {:ok, MapSet.union(acc, child_ids)}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  def collect_node_ids(_), do: {:error, "document.root must contain id and children"}

  def validate_selected_node_id(nil, _node_ids), do: :ok
  def validate_selected_node_id("", _node_ids), do: :ok

  def validate_selected_node_id(node_id, node_ids) when is_binary(node_id) do
    if MapSet.member?(node_ids, node_id) do
      :ok
    else
      {:error, "selected_node_id references an unknown node"}
    end
  end

  def validate_selected_node_id(_, _), do: {:error, "selected_node_id must be a string or null"}

  def validate_model_payload(%{"message" => message, "edits" => edits} = payload, node_ids)
      when is_binary(message) and is_list(edits) do
    with :ok <- validate_warnings(Map.get(payload, "warnings", [])),
         :ok <- validate_edits(edits, node_ids) do
      {:ok,
       %{
         "message" => message,
         "edits" => edits,
         "warnings" => Map.get(payload, "warnings", [])
       }}
    end
  end

  def validate_model_payload(_, _node_ids) do
    {:error, "model response must include message and edits"}
  end

  defp validate_warnings(warnings) when is_list(warnings) do
    if Enum.all?(warnings, &is_binary/1) do
      :ok
    else
      {:error, "warnings must be a list of strings"}
    end
  end

  defp validate_warnings(_), do: {:error, "warnings must be a list of strings"}

  defp validate_edits(edits, node_ids) do
    Enum.reduce_while(edits, :ok, fn edit, :ok ->
      case validate_edit(edit, node_ids) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp validate_edit(%{"type" => "update_text", "nodeId" => node_id, "text" => text}, node_ids)
       when is_binary(text) do
    validate_existing_node(node_id, node_ids)
  end

  defp validate_edit(
         %{"type" => "update_attributes", "nodeId" => node_id, "attributes" => attributes},
         node_ids
       )
       when is_map(attributes) do
    with :ok <- validate_existing_node(node_id, node_ids),
         :ok <- validate_attribute_updates(attributes) do
      :ok
    end
  end

  defp validate_edit(
         %{"type" => "update_styles", "nodeId" => node_id, "className" => class_name},
         node_ids
       )
       when is_binary(class_name) do
    validate_existing_node(node_id, node_ids)
  end

  defp validate_edit(
         %{"type" => "insert_node", "parentId" => parent_id, "node" => node} = edit,
         node_ids
       )
       when is_map(node) do
    with :ok <- validate_existing_node(parent_id, node_ids),
         :ok <- validate_optional_index(Map.get(edit, "index")),
         :ok <- validate_new_node(node) do
      :ok
    end
  end

  defp validate_edit(
         %{
           "type" => "move_node",
           "nodeId" => node_id,
           "targetParentId" => parent_id,
           "index" => index
         },
         node_ids
       )
       when is_integer(index) do
    with :ok <- validate_existing_node(node_id, node_ids),
         :ok <- validate_existing_node(parent_id, node_ids) do
      :ok
    end
  end

  defp validate_edit(%{"type" => "remove_node", "nodeId" => node_id}, node_ids) do
    validate_existing_node(node_id, node_ids)
  end

  defp validate_edit(_edit, _node_ids), do: {:error, "model returned an unsupported edit action"}

  defp validate_existing_node(node_id, node_ids) when is_binary(node_id) do
    if MapSet.member?(node_ids, node_id) do
      :ok
    else
      {:error, "edit references an unknown node"}
    end
  end

  defp validate_existing_node(_, _), do: {:error, "node identifiers must be strings"}

  defp validate_attribute_updates(attributes) do
    Enum.reduce_while(attributes, :ok, fn
      {key, value}, :ok when is_binary(key) and (is_binary(value) or is_nil(value)) ->
        {:cont, :ok}

      _, :ok ->
        {:halt, {:error, "attribute updates must be string or null values"}}
    end)
  end

  defp validate_optional_index(nil), do: :ok
  defp validate_optional_index(index) when is_integer(index), do: :ok
  defp validate_optional_index(_), do: {:error, "insert_node index must be an integer"}

  defp validate_new_node(%{"kind" => kind, "name" => name} = node)
       when kind in ["element", "component", "text"] and is_binary(name) do
    with :ok <- validate_new_node_attributes(Map.get(node, "attributes", %{})),
         :ok <- validate_new_node_text(Map.get(node, "textContent")),
         :ok <- validate_new_node_children(Map.get(node, "children", [])) do
      :ok
    end
  end

  defp validate_new_node(_), do: {:error, "inserted nodes must match the NewEditorNode shape"}

  defp validate_new_node_attributes(attributes) when is_map(attributes) do
    Enum.reduce_while(attributes, :ok, fn
      {key, value}, :ok when is_binary(key) and is_binary(value) -> {:cont, :ok}
      _, :ok -> {:halt, {:error, "new node attributes must be string values"}}
    end)
  end

  defp validate_new_node_attributes(_), do: {:error, "new node attributes must be a map"}

  defp validate_new_node_text(nil), do: :ok
  defp validate_new_node_text(text) when is_binary(text), do: :ok
  defp validate_new_node_text(_), do: {:error, "new node textContent must be a string"}

  defp validate_new_node_children(children) when is_list(children) do
    Enum.reduce_while(children, :ok, fn child, :ok ->
      case validate_new_node(child) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp validate_new_node_children(_), do: {:error, "new node children must be a list"}
end
