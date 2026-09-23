-- 023: FOTO DO CÃO (cadastro do cliente)
--
-- Por que existe: a creche identifica o cão PELA FOTO — na porta do cliente ("é esse?"),
-- no embarque e ao devolver. O campo `dogs.photo_url` existe desde o schema inicial (001)
-- e NENHUMA tela escrevia nele: não havia como anexar a foto de um cão em lugar nenhum
-- do app (a única captura de imagem era o comprovante de entrega do motorista).
--
-- Decisões:
--  - bucket PRÓPRIO ('dog-photos'), separado de 'stop-proofs': o comprovante é registro
--    de prova (não se apaga); a foto do cão é cadastro (troca e sai quando o cão sai).
--  - bucket PÚBLICO: a foto do cão aparece em lista/miniatura (ficha do cliente e parada
--    do motorista) e precisa de URL direta — as do comprovante pedem link assinado porque
--    são prova; a foto do cão não tem dado pessoal (é o rosto do cachorro) e o caminho
--    carrega dois uuids (organização + cão), então não é enumerável.
--  - o caminho começa com o id da ORGANIZAÇÃO (mesma convenção do bucket de comprovante,
--    é o que a política de storage lê para isolar uma creche da outra).

begin;

-- 1) Bucket (8 MB por arquivo; só imagem)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dog-photos', 'dog-photos', true, 8388608,
        array['image/jpeg','image/png','image/heic','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Políticas de escrita: membro ATIVO da organização dona do primeiro diretório.
drop policy if exists dog_photos_insert on storage.objects;
create policy dog_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dog-photos' and public.path_belongs_to_my_org(name));

--    SELECT explícito para membro: bucket público serve o arquivo sem política, MAS a API do
--    storage faz um SELECT antes de apagar a foto — sem esta política o gestor recebia
--    "Access denied" ao trocar/tirar a foto (comprovado pelo teste de ponta a ponta em 23/09).
drop policy if exists dog_photos_read on storage.objects;
create policy dog_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'dog-photos' and public.path_belongs_to_my_org(name));

drop policy if exists dog_photos_update on storage.objects;
create policy dog_photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'dog-photos' and public.path_belongs_to_my_org(name))
  with check (bucket_id = 'dog-photos' and public.path_belongs_to_my_org(name));

-- DELETE existe de propósito (ao contrário do comprovante): trocar a foto de um cão
-- deixaria o arquivo antigo ocupando espaço para sempre, e ao remover o cão do cadastro
-- a foto vai junto.
drop policy if exists dog_photos_delete on storage.objects;
create policy dog_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'dog-photos' and public.path_belongs_to_my_org(name));

commit;
